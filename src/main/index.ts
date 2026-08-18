import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { join, extname, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  createHudWindow,
  createPlaybackWindow,
  createSettingsWindow,
  createLibraryWindow,
  createTtsSettingsWindow,
  createAtMeQueueWindow,
  createMediaWindow,
  createCelebrationWindow,
  createCoinksWindow,
  createHypeTrainWindow,
  type LibraryWindowKind
} from './windowManager'
import { ModuleManager } from './modules/moduleManager'
import { TwitchChatClient } from './modules/twitchChatClient'
import { LiveStudioAudienceModule } from './modules/liveStudioAudienceModule'
import { TextToSpeechModule, TTS_COMMAND } from './modules/textToSpeechModule'
import { CommandModule } from './modules/commandModule'
import { EmoteModule } from './modules/emoteModule'
import { AtMeModule, type AtMeQueueItem } from './modules/atMeModule'
import { MediaGifModule } from './modules/mediaGifModule'
import { CelebrationModule } from './modules/celebrationModule'
import { CoinksModule, type CoinksState } from './modules/coinksModule'
import { HypeTrainModule, type HypeTrainBattleEvent } from './modules/hypeTrainModule'
import { HypeTrainEventSub } from './twitch/hypeTrainEventSub'
import { SettingsStore, type AppSettings } from './settings/settingsStore'
import { SoundLibrary } from './library/soundLibrary'
import { MediaLibrary, SUPPORTED_MEDIA_EXTENSIONS, type MediaTrigger } from './library/mediaLibrary'
import { PlaybackQueue } from './library/playbackQueue'
import { importLegacyData, legacyDataExists } from './library/legacyImport'
import { OverlayServer } from './overlay/overlayServer'
import { CoinksScores } from './library/coinksScores'
import * as twitchAuth from './auth/twitchAuth'
import type { IBotModule } from './modules/types'
import type { SoundTriggerKind } from './library/types'

// The playback window never receives a click/keypress (it's never shown),
// so Chromium's default autoplay policy silently blocks audio.play() there
// otherwise — must be set before the app is ready.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Chromium ships its speech-dispatcher integration off by default on Linux,
// so speechSynthesis reports zero voices and the Text-To-Speech bot is
// silently dead there — the voice dropdown just comes up empty. Enabling it
// is what `--enable-speech-dispatcher` on the command line does; setting it
// here means a normally-launched build behaves the same as one started from
// a terminal with that flag. Also must be set before the app is ready.
//
// Linux-only on purpose: speech-dispatcher doesn't exist on Windows or
// macOS, which reach their system voices through their own backends and
// need no switch. The flag would be inert there, but scoping it keeps it
// from reading as something those platforms depend on.
//
// This needs the speech-dispatcher daemon (`speechd`) plus at least one
// voice package installed on the machine; without them the switch is
// harmless but the voice list stays empty. See README.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-speech-dispatcher')
}

interface ModuleSummary {
  id: string
  displayName: string
  status: string
  enabled: boolean
}

interface BotSummary {
  id: string
  displayName: string
  hidden: boolean
}

interface AuthStatus {
  loggedIn: boolean
  login: string
}

let hudWindow: BrowserWindow | undefined
let playbackWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let ttsSettingsWindow: BrowserWindow | undefined
let atMeQueueWindow: BrowserWindow | undefined
let mediaWindow: BrowserWindow | undefined
let celebrationWindow: BrowserWindow | undefined
let coinksWindow: BrowserWindow | undefined
let hypeTrainWindow: BrowserWindow | undefined
const libraryWindows: Partial<Record<LibraryWindowKind, BrowserWindow>> = {}

const settingsStore = new SettingsStore()
const moduleManager = new ModuleManager()
const chatClient = new TwitchChatClient()
const soundLibrary = new SoundLibrary()
const mediaLibrary = new MediaLibrary()
const playbackQueue = new PlaybackQueue()
const coinksScores = new CoinksScores()
const hypeTrainEventSub = new HypeTrainEventSub()

// Renderer output root, used by the overlay server to serve the OBS page in
// production. In dev it proxies to Vite instead and this is never read.
function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

function gameAssetsRoot(): string {
  return join(resourcesRoot(), 'coinks')
}

function hypeAssetsRoot(): string {
  return join(resourcesRoot(), 'hype')
}

const overlayServer = new OverlayServer(
  rendererRoot,
  (id) => mediaLibrary.get(id),
  () => {
    broadcastOverlayStatus()
    broadcastCelebrationOverlayStatus()
    broadcastCoinksOverlayStatus()
    broadcastHypeTrainOverlayStatus()
  },
  (result) => {
    void coinksScores.record(result.player, result.score)
    coinksModule?.finishGame(result.player)
  },
  gameAssetsRoot,
  hypeAssetsRoot
)

let currentSettings: AppSettings
let atMeModule: AtMeModule | undefined
let coinksModule: CoinksModule | undefined
let hypeTrainModule: HypeTrainModule | undefined

function resourcesRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

function authStatus(): AuthStatus {
  return { loggedIn: Boolean(currentSettings.twitch.accessToken), login: currentSettings.twitch.login }
}

function orderedVisibleModules(): IBotModule[] {
  const hidden = new Set(currentSettings.bots.hidden)
  const order = currentSettings.bots.order
  return moduleManager
    .list()
    .filter((module) => !hidden.has(module.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

function summarize(modules: IBotModule[]): ModuleSummary[] {
  return modules.map((module) => ({
    id: module.id,
    displayName: module.displayName,
    status: module.status,
    enabled: module.enabled
  }))
}

function summarizeAllBots(): BotSummary[] {
  const hidden = new Set(currentSettings.bots.hidden)
  const order = currentSettings.bots.order
  return moduleManager
    .list()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((module) => ({ id: module.id, displayName: module.displayName, hidden: hidden.has(module.id) }))
}

function broadcastModules(): void {
  hudWindow?.webContents.send('hud:modules-changed', summarize(orderedVisibleModules()))
}

// New modules registered after settings.json was last saved (or the very
// first run) need to be appended to the display order; modules that no
// longer exist need to be dropped so the list doesn't grow stale forever.
function reconcileBotOrder(): void {
  const allIds = moduleManager.list().map((module) => module.id)
  const known = new Set(currentSettings.bots.order)
  const missing = allIds.filter((id) => !known.has(id))
  currentSettings.bots.order = [...currentSettings.bots.order.filter((id) => allIds.includes(id)), ...missing]
}

// tmi.js won't pick up new credentials on an already-open connection, so
// login/logout force a real disconnect+reconnect of anything currently
// enabled — reusing ModuleManager's existing start/stop lifecycle rather
// than adding new reset plumbing to TwitchChatClient.
async function reconnectEnabledModules(): Promise<void> {
  const enabledIds = moduleManager
    .list()
    .filter((module) => module.enabled)
    .map((module) => module.id)

  for (const id of enabledIds) await moduleManager.setEnabled(id, false)
  for (const id of enabledIds) await moduleManager.setEnabled(id, true)
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm'
}

// Sent as a data: URL rather than a file:// path — the playback window's
// page is loaded from Vite's dev server (http://localhost) in `npm run dev`
// and from file:// in a built/packaged run. Chromium blocks a file://
// resource load from an http:// page ("Media load rejected by URL safety
// check"), so file:// only ever worked by coincidence when testing the
// built app. A data: URL is just embedded content, not a filesystem
// reference, so it's unaffected by the page's origin either way.
async function sendPlaySound(filePath: string, volume: number): Promise<void> {
  try {
    const buffer = await readFile(filePath)
    const mimeType = AUDIO_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    playbackWindow?.webContents.send('playback:play-sound', dataUrl, volume)
  } catch (error) {
    console.error('[playback] failed to read sound file:', filePath, error)
  }
}

// Bundled reaction sounds (Live Studio Audience), addressed by filename
// under resources/sounds/. Distinct from playTriggerSound below.
function playSound(fileName: string): void {
  const filePath = join(resourcesRoot(), 'sounds', fileName)
  void sendPlaySound(filePath, 1)
}

// User-added library sounds (Command/Emote), addressed by absolute path
// under userData/sounds/.
function playTriggerSound(filePath: string, volume: number): void {
  void sendPlaySound(filePath, volume)
}

function speak(text: string, voiceName: string): void {
  playbackWindow?.webContents.send('playback:speak', text, voiceName)
}

function overlayStatus(): {
  status: string
  url: string
  port: number
  clients: number
  error?: string
} {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl(),
    port: overlayServer.port || currentSettings.modules.mediaGif.overlayPort,
    clients: overlayServer.clientCount('media'),
    error: overlayServer.lastError
  }
}

function broadcastOverlayStatus(): void {
  mediaWindow?.webContents.send('media:overlay-status-changed', overlayStatus())
}

function celebrationOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-fireworks'),
    clients: overlayServer.clientCount('fireworks'),
    error: overlayServer.lastError
  }
}

function broadcastCelebrationOverlayStatus(): void {
  celebrationWindow?.webContents.send('celebration:overlay-status-changed', celebrationOverlayStatus())
}

function startFireworks(shells: number): void {
  overlayServer.broadcast({ type: 'celebration:fireworks', shells, volume: currentSettings.modules.celebration.volume })
}

function coinksOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-coinks'),
    clients: overlayServer.clientCount('coinks'),
    error: overlayServer.lastError
  }
}

function broadcastCoinksOverlayStatus(): void {
  coinksWindow?.webContents.send('coinks:overlay-status-changed', coinksOverlayStatus())
}

function broadcastCoinksState(state: CoinksState): void {
  coinksWindow?.webContents.send('coinks:state-changed', state)
}

// Translates HypeTrainModule's battle events into overlay broadcasts — kept
// here rather than in the module itself so the module stays settings-agnostic
// (volume only needs adding to the 'begin' event; the overlay remembers it
// for the rest of the battle, same as Celebration/Coinks).
function broadcastHypeTrainBattleEvent(event: HypeTrainBattleEvent): void {
  if (event.type === 'hypetrain:begin') {
    overlayServer.broadcast({ ...event, volume: currentSettings.modules.hypeTrain.volume })
  } else {
    overlayServer.broadcast(event)
  }
  broadcastHypeTrainState()
}

function hypeTrainOverlayStatus(): { status: string; url: string; clients: number; error?: string } {
  return {
    status: overlayServer.status,
    url: overlayServer.overlayUrl('overlay-hypetrain'),
    clients: overlayServer.clientCount('hype-train'),
    error: overlayServer.lastError
  }
}

function broadcastHypeTrainOverlayStatus(): void {
  hypeTrainWindow?.webContents.send('hype-train:overlay-status-changed', hypeTrainOverlayStatus())
}

function broadcastHypeTrainState(): void {
  hypeTrainWindow?.webContents.send('hype-train:state-changed', hypeTrainModule?.state())
}

// Media is addressed by id over HTTP rather than by file path — the overlay
// page is a browser source on a different origin from the filesystem, so it
// can't read local files directly (the same constraint that made sounds use
// data: URLs, solved here by simply serving them).
function playMedia(entry: MediaTrigger): void {
  overlayServer.broadcast({
    type: 'media:play',
    id: entry.id,
    url: `/media/${entry.id}`,
    element: entry.element,
    anchor: entry.anchor,
    durationSeconds: entry.durationSeconds,
    volume: entry.volume
  })
}

async function registerModules(): Promise<void> {
  const liveStudioAudience = new LiveStudioAudienceModule(
    chatClient,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    playSound
  )

  const textToSpeech = new TextToSpeechModule(
    chatClient,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    () => currentSettings.modules.textToSpeech,
    speak
  )

  const command = new CommandModule(
    chatClient,
    soundLibrary,
    playbackQueue,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    () => currentSettings.modules.command.allowUserList,
    () => currentSettings.modules.command.userIntrosEnabled,
    () => currentSettings.modules.textToSpeech.freeCommandEnabled,
    playTriggerSound
  )

  const emote = new EmoteModule(
    chatClient,
    soundLibrary,
    playbackQueue,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    playTriggerSound
  )

  const atMe = new AtMeModule(
    chatClient,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    () => currentSettings.modules.atMe,
    (queue) => atMeQueueWindow?.webContents.send('atme:queue-changed', queue)
  )
  atMeModule = atMe

  const mediaGif = new MediaGifModule(
    chatClient,
    mediaLibrary,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    playMedia
  )

  const celebration = new CelebrationModule(
    chatClient,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    () => currentSettings.modules.celebration,
    startFireworks
  )

  moduleManager.register(liveStudioAudience)
  moduleManager.register(textToSpeech)
  moduleManager.register(command)
  moduleManager.register(emote)
  moduleManager.register(atMe)
  moduleManager.register(mediaGif)
  const coinks = new CoinksModule(
    chatClient,
    () => currentSettings.twitch.login,
    () => currentSettings.twitch.accessToken,
    () => currentSettings.modules.coinks,
    () => overlayServer.clientCount('coinks') > 0,
    (player, coinCount) =>
      overlayServer.broadcast({
        type: 'coinks:start',
        player,
        coins: coinCount,
        volume: currentSettings.modules.coinks.volume
      }),
    () => overlayServer.broadcast({ type: 'coinks:throw' }),
    broadcastCoinksState
  )
  coinksModule = coinks

  moduleManager.register(celebration)
  moduleManager.register(coinks)

  const hypeTrain = new HypeTrainModule(
    hypeTrainEventSub,
    () => currentSettings.twitch.userId,
    () => currentSettings.twitch.accessToken,
    broadcastHypeTrainBattleEvent
  )
  hypeTrainModule = hypeTrain
  moduleManager.register(hypeTrain)

  await moduleManager.setEnabled(liveStudioAudience.id, currentSettings.modules.liveStudioAudience.enabled)
  await moduleManager.setEnabled(textToSpeech.id, currentSettings.modules.textToSpeech.enabled)
  await moduleManager.setEnabled(command.id, currentSettings.modules.command.enabled)
  await moduleManager.setEnabled(emote.id, currentSettings.modules.emote.enabled)
  await moduleManager.setEnabled(atMe.id, currentSettings.modules.atMe.enabled)
  await moduleManager.setEnabled(mediaGif.id, currentSettings.modules.mediaGif.enabled)
  await moduleManager.setEnabled(celebration.id, currentSettings.modules.celebration.enabled)
  await moduleManager.setEnabled(coinks.id, currentSettings.modules.coinks.enabled)
  await moduleManager.setEnabled(hypeTrain.id, currentSettings.modules.hypeTrain.enabled)
}

function syncSettingsFromModules(): void {
  const liveStudioAudience = moduleManager.get('live-studio-audience')
  if (liveStudioAudience) currentSettings.modules.liveStudioAudience.enabled = liveStudioAudience.enabled

  const textToSpeech = moduleManager.get('text-to-speech')
  if (textToSpeech) currentSettings.modules.textToSpeech.enabled = textToSpeech.enabled

  const command = moduleManager.get('command')
  if (command) currentSettings.modules.command.enabled = command.enabled

  const emote = moduleManager.get('emote')
  if (emote) currentSettings.modules.emote.enabled = emote.enabled

  const atMe = moduleManager.get('at-me')
  if (atMe) currentSettings.modules.atMe.enabled = atMe.enabled

  const mediaGif = moduleManager.get('media-gif')
  if (mediaGif) currentSettings.modules.mediaGif.enabled = mediaGif.enabled

  const celebration = moduleManager.get('celebration')
  if (celebration) currentSettings.modules.celebration.enabled = celebration.enabled

  const coinks = moduleManager.get('coinks')
  if (coinks) currentSettings.modules.coinks.enabled = coinks.enabled

  const hypeTrain = moduleManager.get('hype-train')
  if (hypeTrain) currentSettings.modules.hypeTrain.enabled = hypeTrain.enabled
}

function toggleLibraryWindow(kind: LibraryWindowKind): void {
  const existing = libraryWindows[kind]
  if (existing) {
    existing.close()
    return
  }
  libraryWindows[kind] = createLibraryWindow(
    kind,
    () => {
      delete libraryWindows[kind]
    },
    hudWindow
  )
}

function toggleTtsSettingsWindow(): void {
  if (ttsSettingsWindow) {
    ttsSettingsWindow.close()
    return
  }
  ttsSettingsWindow = createTtsSettingsWindow(() => {
    ttsSettingsWindow = undefined
  }, hudWindow)
}

function toggleAtMeQueueWindow(): void {
  if (atMeQueueWindow) {
    atMeQueueWindow.close()
    return
  }
  atMeQueueWindow = createAtMeQueueWindow(() => {
    atMeQueueWindow = undefined
  }, hudWindow)
}

function toggleMediaWindow(): void {
  if (mediaWindow) {
    mediaWindow.close()
    return
  }
  mediaWindow = createMediaWindow(() => {
    mediaWindow = undefined
  }, hudWindow)
}

function toggleCoinksWindow(): void {
  if (coinksWindow) {
    coinksWindow.close()
    return
  }
  coinksWindow = createCoinksWindow(() => {
    coinksWindow = undefined
  }, hudWindow)
}

function toggleCelebrationWindow(): void {
  if (celebrationWindow) {
    celebrationWindow.close()
    return
  }
  celebrationWindow = createCelebrationWindow(() => {
    celebrationWindow = undefined
  }, hudWindow)
}

function toggleHypeTrainWindow(): void {
  if (hypeTrainWindow) {
    hypeTrainWindow.close()
    return
  }
  hypeTrainWindow = createHypeTrainWindow(() => {
    hypeTrainWindow = undefined
  }, hudWindow)
}

function registerIpcHandlers(): void {
  ipcMain.handle('hud:get-modules', () => summarize(orderedVisibleModules()))

  ipcMain.handle('hud:toggle-module', async (_event, id: string) => {
    const module = moduleManager.get(id)
    if (!module) return summarize(orderedVisibleModules())

    await moduleManager.setEnabled(id, !module.enabled)
    syncSettingsFromModules()
    await settingsStore.save(currentSettings)
    broadcastModules()

    return summarize(orderedVisibleModules())
  })

  ipcMain.on('hud:open-settings', () => {
    if (settingsWindow) {
      settingsWindow.focus()
      return
    }
    settingsWindow = createSettingsWindow(() => {
      settingsWindow = undefined
    }, hudWindow)
  })

  ipcMain.on('hud:toggle-settings', () => {
    if (settingsWindow) {
      settingsWindow.close()
      return
    }
    settingsWindow = createSettingsWindow(() => {
      settingsWindow = undefined
    }, hudWindow)
  })

  ipcMain.on('hud:open-library', (_event, id: string) => {
    if (id === 'command' || id === 'emote') toggleLibraryWindow(id)
    else if (id === 'text-to-speech') toggleTtsSettingsWindow()
    else if (id === 'at-me') toggleAtMeQueueWindow()
    else if (id === 'media-gif') toggleMediaWindow()
    else if (id === 'celebration') toggleCelebrationWindow()
    else if (id === 'coinks') toggleCoinksWindow()
    else if (id === 'hype-train') toggleHypeTrainWindow()
  })

  ipcMain.on('hud:quit', () => {
    app.quit()
  })

  // resizable: false on the HUD only blocks the user dragging its edges —
  // setBounds() from code still works, which is how the bar shrinks/grows
  // to match its actual tile count instead of leaving blank space.
  ipcMain.on('hud:resize', (_event, width: number) => {
    if (!hudWindow) return
    const bounds = hudWindow.getBounds()
    hudWindow.setBounds({ ...bounds, width })
  })

  ipcMain.handle('settings:get-auth-status', () => authStatus())

  ipcMain.handle('settings:login', async () => {
    const result = await twitchAuth.login(hudWindow)
    if (result) {
      currentSettings.twitch = result
      await settingsStore.save(currentSettings)
      await reconnectEnabledModules()
    }
    return authStatus()
  })

  ipcMain.handle('settings:logout', async () => {
    await twitchAuth.logout(currentSettings.twitch.accessToken)
    currentSettings.twitch = { accessToken: '', login: '', userId: '', expiresAt: 0 }
    await settingsStore.save(currentSettings)
    await reconnectEnabledModules()
    return authStatus()
  })

  ipcMain.handle('settings:get-bots', () => summarizeAllBots())

  ipcMain.handle('settings:set-bot-order', async (_event, order: string[]) => {
    currentSettings.bots.order = order
    await settingsStore.save(currentSettings)
    broadcastModules()
  })

  ipcMain.handle('settings:set-bot-hidden', async (_event, id: string, hidden: boolean) => {
    const set = new Set(currentSettings.bots.hidden)
    if (hidden) set.add(id)
    else set.delete(id)
    currentSettings.bots.hidden = [...set]
    await settingsStore.save(currentSettings)
    broadcastModules()
  })

  // Backs the "Import from old MultiBot" section: the section itself only
  // renders when the old .NET app's data directory exists, and each of its
  // two rows (sounds/text vs. media) drops off independently once that
  // import has actually been run, so re-running it can't duplicate entries.
  ipcMain.handle('settings:get-legacy-import-status', async () => ({
    dirExists: await legacyDataExists(),
    soundsImported: currentSettings.legacyImport.soundsImported,
    mediaImported: currentSettings.legacyImport.mediaImported
  }))

  ipcMain.handle('settings:import-legacy-sounds', async () => {
    const summary = await importLegacyData(soundLibrary)
    currentSettings.legacyImport.soundsImported = true
    await settingsStore.save(currentSettings)
    return summary
  })

  ipcMain.handle('settings:import-legacy-media', async () => {
    const summary = await mediaLibrary.importLegacy()
    currentSettings.legacyImport.mediaImported = true
    await settingsStore.save(currentSettings)
    return summary
  })

  ipcMain.handle('tts-settings:get', () => currentSettings.modules.textToSpeech)

  // Reports Command-bot entries the free !tts command would shadow, so the
  // TTS window can warn about them. Checked live on each open rather than
  // cached: the Library window can add a !tts entry at any time.
  ipcMain.handle('tts-settings:command-conflicts', () => {
    const matches = (text: string): boolean =>
      (text.startsWith('!') ? text.slice(1) : text).trim().toLowerCase() === TTS_COMMAND

    return {
      sounds: soundLibrary.listSounds('command').filter((sound) => matches(sound.trigger)).length,
      textReplies: soundLibrary.listTextReplies().filter((reply) => matches(reply.command)).length
    }
  })

  ipcMain.handle(
    'tts-settings:set',
    async (_event, patch: Partial<{ enabled: boolean; minimumBits: number; voiceName: string; freeCommandEnabled: boolean }>) => {
      currentSettings.modules.textToSpeech = { ...currentSettings.modules.textToSpeech, ...patch }
      await settingsStore.save(currentSettings)
    }
  )

  ipcMain.on('playback:sound-ended', () => {
    playbackQueue.release()
  })

  // Surfaces otherwise-silent playback failures (e.g. a blocked audio.play())
  // to this process's console, since the playback window is never shown and
  // has no visible devtools to check.
  ipcMain.on('playback:error', (_event, message: string) => {
    console.error('[playback]', message)
  })

  // Shared by the Settings and Library windows' custom titlebars, since
  // they're frameless and have no OS-provided close button.
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('library:list-sounds', (_event, kind: SoundTriggerKind) => soundLibrary.listSounds(kind))

  ipcMain.handle('library:add-sound-from-dialog', async (event, kind: SoundTriggerKind, trigger: string, volume: number) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm', 'weba'] }]
    }
    // Tied to the Library window that opened it — an untied dialog can open
    // unfocused or behind the parent window on some Linux window managers.
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return null

    return soundLibrary.addSound(kind, trigger, result.filePaths[0], volume)
  })

  ipcMain.handle('library:update-sound', (_event, id: string, patch: { trigger?: string; volume?: number }) =>
    soundLibrary.updateSound(id, patch)
  )

  ipcMain.handle('library:remove-sound', (_event, id: string) => soundLibrary.removeSound(id))

  ipcMain.on('library:preview-sound', (_event, filePath: string, volume: number) => {
    playTriggerSound(filePath, volume)
  })

  ipcMain.handle('library:list-text-replies', () => soundLibrary.listTextReplies())

  ipcMain.handle('library:add-text-reply', (_event, command: string, reply: string) =>
    soundLibrary.addTextReply(command, reply)
  )

  ipcMain.handle('library:update-text-reply', (_event, id: string, patch: { command?: string; reply?: string }) =>
    soundLibrary.updateTextReply(id, patch)
  )

  ipcMain.handle('library:remove-text-reply', (_event, id: string) => soundLibrary.removeTextReply(id))

  ipcMain.handle('library:get-allow-user-list', () => currentSettings.modules.command.allowUserList)

  ipcMain.handle('library:set-allow-user-list', async (_event, value: boolean) => {
    currentSettings.modules.command.allowUserList = value
    await settingsStore.save(currentSettings)
  })

  ipcMain.handle('library:get-user-intros-enabled', () => currentSettings.modules.command.userIntrosEnabled)

  ipcMain.handle('library:get-tts-command-enabled', () => currentSettings.modules.textToSpeech.freeCommandEnabled)

  ipcMain.handle('library:set-user-intros-enabled', async (_event, value: boolean) => {
    currentSettings.modules.command.userIntrosEnabled = value
    await settingsStore.save(currentSettings)
  })

  ipcMain.handle('atme:get-settings', () => ({
    matchMentions: currentSettings.modules.atMe.matchMentions,
    matchHighlights: currentSettings.modules.atMe.matchHighlights,
    togglesCollapsed: currentSettings.modules.atMe.togglesCollapsed
  }))

  ipcMain.handle(
    'atme:set-settings',
    async (_event, patch: Partial<{ matchMentions: boolean; matchHighlights: boolean; togglesCollapsed: boolean }>) => {
      currentSettings.modules.atMe = { ...currentSettings.modules.atMe, ...patch }
      await settingsStore.save(currentSettings)
    }
  )

  ipcMain.handle('atme:list-queue', (): AtMeQueueItem[] => atMeModule?.listQueue() ?? [])

  ipcMain.handle('atme:dismiss', (_event, id: string) => {
    atMeModule?.dismiss(id)
  })

  ipcMain.handle('media:list', () => mediaLibrary.list())

  ipcMain.handle('media:add-from-dialog', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: SUPPORTED_MEDIA_EXTENSIONS }]
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return []

    // Command defaults to the filename without extension, matching how the old
    // app seeded it on drag-and-drop.
    const added: MediaTrigger[] = []
    for (const filePath of result.filePaths) {
      added.push(await mediaLibrary.add(basename(filePath, extname(filePath)), filePath))
    }
    return added
  })

  ipcMain.handle('media:update', (_event, id: string, patch: Partial<MediaTrigger>) => mediaLibrary.update(id, patch))

  ipcMain.handle('media:remove', (_event, id: string) => mediaLibrary.remove(id))

  ipcMain.handle('media:test', (_event, id: string) => {
    const entry = mediaLibrary.get(id)
    if (entry) playMedia(entry)
  })

  ipcMain.handle('media:overlay-status', () => overlayStatus())

  ipcMain.handle('celebration:get-settings', () => ({
    bitsPrice: currentSettings.modules.celebration.bitsPrice,
    commandEnabled: currentSettings.modules.celebration.commandEnabled,
    shellCount: currentSettings.modules.celebration.shellCount,
    volume: currentSettings.modules.celebration.volume
  }))

  ipcMain.handle(
    'celebration:set-settings',
    async (_event, patch: Partial<{ bitsPrice: number; commandEnabled: boolean; shellCount: number; volume: number }>) => {
      currentSettings.modules.celebration = { ...currentSettings.modules.celebration, ...patch }
      await settingsStore.save(currentSettings)
    }
  )

  ipcMain.handle('celebration:test', () => {
    startFireworks(currentSettings.modules.celebration.shellCount)
  })

  ipcMain.handle('celebration:overlay-status', () => celebrationOverlayStatus())

  ipcMain.handle('coinks:get-settings', () => ({
    bitsPrice: currentSettings.modules.coinks.bitsPrice,
    commandEnabled: currentSettings.modules.coinks.commandEnabled,
    coinsPerGame: currentSettings.modules.coinks.coinsPerGame,
    volume: currentSettings.modules.coinks.volume
  }))

  ipcMain.handle(
    'coinks:set-settings',
    async (_event, patch: Partial<{ bitsPrice: number; commandEnabled: boolean; coinsPerGame: number; volume: number }>) => {
      currentSettings.modules.coinks = { ...currentSettings.modules.coinks, ...patch }
      await settingsStore.save(currentSettings)
    }
  )

  ipcMain.handle('coinks:get-state', () => coinksModule?.state() ?? { currentPlayer: undefined, queue: [] })

  ipcMain.handle('coinks:enqueue', (_event, player: string) => {
    coinksModule?.enqueue(player)
  })

  ipcMain.handle('coinks:leaderboard', () => coinksScores.leaderboard())

  ipcMain.handle('coinks:overlay-status', () => coinksOverlayStatus())

  ipcMain.handle('hype-train:get-settings', () => ({
    volume: currentSettings.modules.hypeTrain.volume
  }))

  ipcMain.handle('hype-train:set-settings', async (_event, patch: Partial<{ volume: number }>) => {
    currentSettings.modules.hypeTrain = { ...currentSettings.modules.hypeTrain, ...patch }
    await settingsStore.save(currentSettings)
  })

  ipcMain.handle('hype-train:test', () => {
    hypeTrainModule?.simulate()
  })

  ipcMain.handle('hype-train:get-state', () => hypeTrainModule?.state() ?? { active: false, level: 1, archerCount: 0 })

  ipcMain.handle('hype-train:overlay-status', () => hypeTrainOverlayStatus())

  ipcMain.handle('media:set-port', async (_event, port: number) => {
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== overlayServer.port) {
      currentSettings.modules.mediaGif.overlayPort = port
      await settingsStore.save(currentSettings)
      await overlayServer.start(port)
    }
    return overlayStatus()
  })
}

app.whenReady().then(async () => {
  // BrowserWindow's `icon` option (set per-window in windowManager.ts) is
  // ignored on macOS — the dock icon has to be set here instead.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(join(resourcesRoot(), 'icon.png'))
  }

  currentSettings = await settingsStore.load()
  await soundLibrary.load()
  await mediaLibrary.load()
  await coinksScores.load()

  registerIpcHandlers()
  await registerModules()
  reconcileBotOrder()
  await settingsStore.save(currentSettings)

  // Started independently of whether the Media bot is enabled, so the streamer
  // can add the browser source in OBS and see it connect before turning the bot
  // on. It's an idle localhost listener until something broadcasts.
  await overlayServer.start(currentSettings.modules.mediaGif.overlayPort)

  playbackWindow = createPlaybackWindow()
  hudWindow = createHudWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void moduleManager.stopAll()
  void overlayServer.stop()
})
