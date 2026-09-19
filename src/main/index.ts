import { app } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { registerModules, reconcileBotOrder, watchModuleStatus } from './modules/moduleRegistry'
import { checkForUpdatesOnStartup } from './updates/updateService'
import { loadSettings, getSettings, saveSettings } from './app/settingsState'
import { moduleManager, soundLibrary, mediaLibrary, coinksScores } from './app/services'
import { overlayServer } from './overlay/overlayService'
import { resourcesRoot } from './app/paths'
import * as windows from './windows/windowRegistry'

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

  // After the HUD exists, so the first status broadcast has somewhere to go.
  watchModuleStatus()

  // Check for updates after HUD window is created (so we can notify the renderer)
  void checkForUpdatesOnStartup()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  moduleManager.stopWatching()
  void moduleManager.stopAll()
  void overlayServer.stop()
})
