import { app, ipcMain, dialog, BrowserWindow, shell, screen } from 'electron'
import { join, extname, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { LibraryWindowKind } from './windowManager'
import { registerIpcHandlers as registerExtractedIpc } from './ipc'
import { playSound, playTriggerSound, speak } from './audio/playbackBridge'
import * as windows from './windows/windowRegistry'
import {
  overlayServer,
  overlayStatus,
  celebrationOverlayStatus,
  coinksOverlayStatus,
  hypeTrainOverlayStatus,
  broadcastCoinksState,
  broadcastHypeTrainBattleEvent,
  startFireworks,
  playMedia
} from './overlay/overlayService'
import { LiveStudioAudienceModule } from './modules/liveStudioAudienceModule'
import { TextToSpeechModule, TTS_COMMAND } from './modules/textToSpeechModule'
import { CommandModule } from './modules/commandModule'
import { EmoteModule } from './modules/emoteModule'
import { AtMeModule, type AtMeQueueItem } from './modules/atMeModule'
import { MediaGifModule } from './modules/mediaGifModule'
import { CelebrationModule } from './modules/celebrationModule'
import { CoinksModule } from './modules/coinksModule'
import { HypeTrainModule } from './modules/hypeTrainModule'
import { loadSettings, getSettings, saveSettings } from './app/settingsState'
import { SUPPORTED_MEDIA_EXTENSIONS, type MediaTrigger } from './library/mediaLibrary'
import { importLegacyData, legacyDataExists } from './library/legacyImport'
import { UpdateChecker } from './updates/updateChecker'
import * as twitchAuth from './auth/twitchAuth'
import { moduleRefs } from './modules/moduleRefs'
import {
  moduleManager,
  chatClient,
  soundLibrary,
  mediaLibrary,
  playbackQueue,
  coinksScores,
  hypeTrainEventSub
} from './app/services'
import { resourcesRoot } from './app/paths'
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



let updateChecker: UpdateChecker | undefined

interface PendingUpdate {
  current: string
  latest: string
  releaseUrl: string
  body: string
}

let pendingUpdate: PendingUpdate | undefined

function authStatus(): AuthStatus {
  return { loggedIn: Boolean(getSettings().twitch.accessToken), login: getSettings().twitch.login }
}

function orderedVisibleModules(): IBotModule[] {
  const hidden = new Set(getSettings().bots.hidden)
  const order = getSettings().bots.order
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
  const hidden = new Set(getSettings().bots.hidden)
  const order = getSettings().bots.order
  return moduleManager
    .list()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((module) => ({ id: module.id, displayName: module.displayName, hidden: hidden.has(module.id) }))
}

function broadcastModules(): void {
  windows.sendHud('hud:modules-changed', summarize(orderedVisibleModules()))
}

// New modules registered after settings.json was last saved (or the very
// first run) need to be appended to the display order; modules that no
// longer exist need to be dropped so the list doesn't grow stale forever.
function reconcileBotOrder(): void {
  const allIds = moduleManager.list().map((module) => module.id)
  const known = new Set(getSettings().bots.order)
  const missing = allIds.filter((id) => !known.has(id))
  getSettings().bots.order = [...getSettings().bots.order.filter((id) => allIds.includes(id)), ...missing]
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

async function registerModules(): Promise<void> {
  const liveStudioAudience = new LiveStudioAudienceModule(
    chatClient,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    playSound
  )

  const textToSpeech = new TextToSpeechModule(
    chatClient,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    () => getSettings().modules.textToSpeech,
    speak
  )

  const command = new CommandModule(
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

  const emote = new EmoteModule(
    chatClient,
    soundLibrary,
    playbackQueue,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    playTriggerSound
  )

  const atMe = new AtMeModule(
    chatClient,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    () => getSettings().modules.atMe,
    (queue) => windows.send('atme-queue', 'atme:queue-changed', queue)
  )
  moduleRefs.atMe = atMe

  const mediaGif = new MediaGifModule(
    chatClient,
    mediaLibrary,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    playMedia
  )

  const celebration = new CelebrationModule(
    chatClient,
    () => getSettings().twitch.login,
    () => getSettings().twitch.accessToken,
    () => getSettings().modules.celebration,
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

  moduleManager.register(celebration)
  moduleManager.register(coinks)

  const hypeTrain = new HypeTrainModule(
    hypeTrainEventSub,
    () => getSettings().twitch.userId,
    () => getSettings().twitch.accessToken,
    broadcastHypeTrainBattleEvent
  )
  moduleRefs.hypeTrain = hypeTrain
  moduleManager.register(hypeTrain)

  await moduleManager.setEnabled(liveStudioAudience.id, getSettings().modules.liveStudioAudience.enabled)
  await moduleManager.setEnabled(textToSpeech.id, getSettings().modules.textToSpeech.enabled)
  await moduleManager.setEnabled(command.id, getSettings().modules.command.enabled)
  await moduleManager.setEnabled(emote.id, getSettings().modules.emote.enabled)
  await moduleManager.setEnabled(atMe.id, getSettings().modules.atMe.enabled)
  await moduleManager.setEnabled(mediaGif.id, getSettings().modules.mediaGif.enabled)
  await moduleManager.setEnabled(celebration.id, getSettings().modules.celebration.enabled)
  await moduleManager.setEnabled(coinks.id, getSettings().modules.coinks.enabled)
  await moduleManager.setEnabled(hypeTrain.id, getSettings().modules.hypeTrain.enabled)
}

function syncSettingsFromModules(): void {
  const liveStudioAudience = moduleManager.get('live-studio-audience')
  if (liveStudioAudience) getSettings().modules.liveStudioAudience.enabled = liveStudioAudience.enabled

  const textToSpeech = moduleManager.get('text-to-speech')
  if (textToSpeech) getSettings().modules.textToSpeech.enabled = textToSpeech.enabled

  const command = moduleManager.get('command')
  if (command) getSettings().modules.command.enabled = command.enabled

  const emote = moduleManager.get('emote')
  if (emote) getSettings().modules.emote.enabled = emote.enabled

  const atMe = moduleManager.get('at-me')
  if (atMe) getSettings().modules.atMe.enabled = atMe.enabled

  const mediaGif = moduleManager.get('media-gif')
  if (mediaGif) getSettings().modules.mediaGif.enabled = mediaGif.enabled

  const celebration = moduleManager.get('celebration')
  if (celebration) getSettings().modules.celebration.enabled = celebration.enabled

  const coinks = moduleManager.get('coinks')
  if (coinks) getSettings().modules.coinks.enabled = coinks.enabled

  const hypeTrain = moduleManager.get('hype-train')
  if (hypeTrain) getSettings().modules.hypeTrain.enabled = hypeTrain.enabled
}

function toggleLibraryWindow(kind: LibraryWindowKind): void {
  windows.toggle(kind === 'command' ? 'library:command' : 'library:emote')
}

function toggleTtsSettingsWindow(): void {
  windows.toggle('tts-settings')
}

function toggleAtMeQueueWindow(): void {
  windows.toggle('atme-queue')
}

function toggleMediaWindow(): void {
  windows.toggle('media')
}

function toggleCoinksWindow(): void {
  windows.toggle('coinks')
}

function toggleCelebrationWindow(): void {
  windows.toggle('celebration')
}

function toggleHypeTrainWindow(): void {
  windows.toggle('hype-train')
}

// Focuses rather than closes when already open — see the note on open/toggle
// in windowRegistry.ts.
function openUpdateDetailsWindow(): void {
  windows.open('update-details')
}

function registerIpcHandlers(): void {
  registerExtractedIpc()

  ipcMain.handle('hud:get-modules', () => summarize(orderedVisibleModules()))

  ipcMain.handle('hud:toggle-module', async (_event, id: string) => {
    const module = moduleManager.get(id)
    if (!module) return summarize(orderedVisibleModules())

    await moduleManager.setEnabled(id, !module.enabled)
    syncSettingsFromModules()
    await saveSettings()
    broadcastModules()

    return summarize(orderedVisibleModules())
  })

  ipcMain.on('hud:open-settings', () => {
    windows.open('settings')
  })

  ipcMain.on('hud:toggle-settings', () => {
    windows.toggle('settings')
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

  // Grows/shrinks the HUD to match its actual content (tile count, whether
  // the update button is showing) instead of leaving blank space or clipping
  // content. Keeps the right edge fixed and grows/shrinks leftward instead of
  // the default setBounds() behavior of holding x fixed and extending
  // rightward — a streamer who's dragged the HUD toward their screen's right
  // edge (common, to stay clear of capture layout) would otherwise have new
  // content pushed off-screen the moment the bar needs to grow wider than it
  // was when they positioned it.
  ipcMain.on('hud:resize', (_event, width: number) => {
    const hud = windows.getHud()
    if (!hud) return
    const bounds = hud.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const rightEdge = bounds.x + bounds.width
    const x = Math.max(rightEdge - width, workArea.x)
    hud.setBounds({ ...bounds, x, width })
  })

  ipcMain.handle('settings:get-auth-status', () => authStatus())

  ipcMain.handle('settings:login', async () => {
    const result = await twitchAuth.login(windows.getHud())
    if (result) {
      getSettings().twitch = result
      await saveSettings()
      await reconnectEnabledModules()
    }
    return authStatus()
  })

  ipcMain.handle('settings:logout', async () => {
    await twitchAuth.logout(getSettings().twitch.accessToken)
    getSettings().twitch = { accessToken: '', login: '', userId: '', expiresAt: 0 }
    await saveSettings()
    await reconnectEnabledModules()
    return authStatus()
  })

  ipcMain.handle('settings:get-bots', () => summarizeAllBots())

  ipcMain.handle('settings:set-bot-order', async (_event, order: string[]) => {
    getSettings().bots.order = order
    await saveSettings()
    broadcastModules()
  })

  ipcMain.handle('settings:set-bot-hidden', async (_event, id: string, hidden: boolean) => {
    const set = new Set(getSettings().bots.hidden)
    if (hidden) set.add(id)
    else set.delete(id)
    getSettings().bots.hidden = [...set]
    await saveSettings()
    broadcastModules()
  })

  // Backs the "Import from old MultiBot" section: the section itself only
  // renders when the old .NET app's data directory exists, and each of its
  // two rows (sounds/text vs. media) drops off independently once that
  // import has actually been run, so re-running it can't duplicate entries.
  ipcMain.handle('settings:get-legacy-import-status', async () => ({
    dirExists: await legacyDataExists(),
    soundsImported: getSettings().legacyImport.soundsImported,
    mediaImported: getSettings().legacyImport.mediaImported
  }))

  ipcMain.handle('settings:import-legacy-sounds', async () => {
    const summary = await importLegacyData(soundLibrary)
    getSettings().legacyImport.soundsImported = true
    await saveSettings()
    return summary
  })

  ipcMain.handle('settings:import-legacy-media', async () => {
    const summary = await mediaLibrary.importLegacy()
    getSettings().legacyImport.mediaImported = true
    await saveSettings()
    return summary
  })

  ipcMain.on('updates:dismiss', async (_event, version: string) => {
    getSettings().updates.dismissedVersion = version
    await saveSettings()
    // The badge only disappears once dismissal is confirmed here, rather than
    // optimistically in the renderer, so a HUD restart before this save
    // lands can't leave the badge permanently hidden for an update that was
    // never actually recorded as dismissed.
    if (pendingUpdate?.latest === version) {
      pendingUpdate = undefined
    }
    windows.sendHud('updates:dismissed')
  })

  ipcMain.handle('updates:get-enabled', () => getSettings().updates.enabled)

  ipcMain.handle('updates:set-enabled', async (_event, enabled: boolean) => {
    getSettings().updates.enabled = enabled
    await saveSettings()
  })

  ipcMain.on('hud:open-update-details', () => {
    openUpdateDetailsWindow()
  })

  ipcMain.handle('update-details:get', () => pendingUpdate)
}

async function checkForUpdatesOnStartup(): Promise<void> {
  if (!getSettings().updates.enabled) {
    return
  }

  const lastCheck = getSettings().updates.lastCheckTime ?? 0
  const hoursSinceLastCheck = (Date.now() - lastCheck) / (1000 * 60 * 60)
  if (hoursSinceLastCheck < 12) {
    return
  }

  updateChecker = new UpdateChecker(app.getVersion())
  const result = await updateChecker.checkForUpdates()

  if (result.updateAvailable && result.latest && result.latest.version !== getSettings().updates.dismissedVersion) {
    pendingUpdate = {
      current: result.current,
      latest: result.latest.version,
      releaseUrl: result.latest.releaseUrl,
      body: result.latest.body
    }
    windows.sendHud('updates:available')
  }

  getSettings().updates.lastCheckTime = Date.now()
  await saveSettings()
}

app.whenReady().then(async () => {
  // BrowserWindow's `icon` option (set per-window in windowManager.ts) is
  // ignored on macOS — the dock icon has to be set here instead.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(join(resourcesRoot(), 'icon.png'))
  }

  await loadSettings()
  await soundLibrary.load()
  await mediaLibrary.load()
  await coinksScores.load()

  registerIpcHandlers()
  await registerModules()
  reconcileBotOrder()
  await saveSettings()

  // Started independently of whether the Media bot is enabled, so the streamer
  // can add the browser source in OBS and see it connect before turning the bot
  // on. It's an idle localhost listener until something broadcasts.
  await overlayServer.start(getSettings().modules.mediaGif.overlayPort)

  windows.createPlayback()
  windows.createHud()

  // Check for updates after HUD window is created (so we can notify the renderer)
  void checkForUpdatesOnStartup()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void moduleManager.stopAll()
  void overlayServer.stop()
})
